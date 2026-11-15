
document.writeln("	<script type=\"text/javascript\">");
document.writeln("		var sns_sys_id = '';");
document.writeln("		var sns_view_point_token = '';");
document.writeln("		var hash = window.location.hash;");
document.writeln("		if(!hash){");
document.writeln("			hash = 0;");
document.writeln("		}else{");
document.writeln("			hash = parseInt(hash.replace(\"#\",\"\")) - 1;");
document.writeln("		}");
document.writeln("		var fast_img_host=\"\";");
document.writeln("		var imglist = [{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/000.webp?verify=1794722400-msnZ0PLyx-TOGlpj8nr2GrH8QVf6W6OcPH2jezujdBI\", caption: \"[000]\"},{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/001.webp?verify=1794722400-xLBajRWBuvAvarfX-8P0w-FuGdWh8t0xF1lfaKTCrEQ\", caption: \"[001]\"},{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/002.webp?verify=1794722400-Jluqr1pOzXe2HGUAmcc_aIDNe3r_fZYxf_2a_ToEMxY\", caption: \"[002]\"},{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/003.webp?verify=1794722400-8MHX07DElxTE5XsXc3XqbGFGhK0IUYl9BnfQyR9BMt4\", caption: \"[003]\"},{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/004.webp?verify=1794722400-5e--nRT7Cjy_qvvC8YQ34O91Lh6Xpm-L1tabT7R_Loo\", caption: \"[004]\"},{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/005.webp?verify=1794722400-oNa8b_rYQ4Wabt-cCGrEYBwF1sf_soC_A63QYAgmq-o\", caption: \"[005]\"},{ url: fast_img_host+\"//img5.wnimg2.cfd/data/4048/82/006.webp?verify=1794722400-GrZLlDE7fkxfM281-4s76c2z8BNi9pPkCQ_62qMlFyU\", caption: \"[006]\"},{ url: fast_img_host+\"/themes/weitu/images/bg/shoucang.jpg\", caption: \"喜歡紳士漫畫的同學請加入收藏哦！\"}];");
document.writeln("");
document.writeln("		$(function(){");
document.writeln("			imgscroll.beLoad($(\"#img_list\"),imglist,hash);");
document.writeln("		});");
document.writeln("	</script>");